import { Injectable, BadRequestException } from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';
import { Readable } from 'stream';

const MAX_BYTES = 4 * 1024 * 1024;

@Injectable()
export class UploadService {
  constructor() {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });
  }

  async uploadStream(
    fileStream: Readable,
    folder: string,
    mimeType: string,
    onProgress?: (percent: number) => void,
  ): Promise<any> {
    let uploaded = 0;

    return new Promise((resolve, reject) => {
      const cloudStream = cloudinary.uploader.upload_stream(
        {
          folder: `wild-oasis/${folder}`,
          resource_type: 'image',
          unique_filename: true,
        },
        (err, result) => {
          if (err) return reject(err);
          resolve(result);
        },
      );

      fileStream.on('data', (chunk: Buffer) => {
        uploaded += chunk.length;

        if (uploaded > MAX_BYTES) {
          fileStream.destroy();
          cloudStream.destroy();
          reject(new BadRequestException('File too large'));
        }

        if (onProgress) {
          onProgress(Math.round((uploaded / MAX_BYTES) * 100));
        }
      });

      fileStream.pipe(cloudStream);
      fileStream.on('error', reject);
    });
  }

  async deleteByPublicId(publicId: string) {
    await cloudinary.uploader.destroy(publicId);
  }
}
