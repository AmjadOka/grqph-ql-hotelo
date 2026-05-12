/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/unbound-method */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import { Resolver, Mutation, Args } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { UploadService } from './upload.service';
import { UploadResponse } from './dto/upload-response.dto';
import { UserService } from 'src/user/user.service';
const { GraphQLUpload } = require('graphql-upload-minimal');
import { type FileUpload } from 'graphql-upload-minimal';
import { type UploadApiResponse } from 'cloudinary';
import { GqlAuthGuard } from 'src/common/guards/gql-auth.guard';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { Roles } from 'src/common/decorators/roles.decorator';
import { UserRole } from 'src/user/user.schema';

@Resolver()
export class UploadResolver {
  constructor(
    private readonly uploadService: UploadService,
    private readonly userService: UserService,
  ) {}

  // ─── Cabin image — admin only ──────────────────────────────────────
  @Roles(UserRole.MANAGER)
  @UseGuards(GqlAuthGuard)
  @Mutation(() => UploadResponse)
  async uploadCabinImage(
    @Args({ name: 'file', type: () => GraphQLUpload })
    file: Promise<FileUpload>,
    @CurrentUser() user,
  ): Promise<UploadResponse> {
    if (user.role !== 'admin') {
      throw new Error('Forbidden');
    }

    const { createReadStream, mimetype, filename } = await file;

    const stream = createReadStream();

    const result: UploadApiResponse = await this.uploadService.uploadStream(
      stream,
      'cabins',
      mimetype,
      (percent) => {
        console.log(`${filename}: ${percent}%`);
      },
    );

    return {
      url: result.secure_url,
      publicId: result.public_id,
      folder: 'cabins',
    };
  }

  @UseGuards(GqlAuthGuard)
  @Mutation(() => [String])
  async uploadFiles(
    @Args({
      name: 'files',
      type: () => [GraphQLUpload],
    })
    files: Promise<FileUpload>[],
  ): Promise<string[]> {
    const uploadedUrls = await Promise.all(
      files.map(async (filePromise) => {
        const file = await filePromise;

        const stream = file.createReadStream();

        const result = await this.uploadService.uploadStream(
          stream,
          'uploads',
          file.mimetype,
        );

        return result.secure_url;
      }),
    );

    return uploadedUrls;
  }
  // ─── Avatar upload — authenticated user uploads their own ──────────
  @Roles(UserRole.GUEST)
  @UseGuards(GqlAuthGuard)
  @Mutation(() => UploadResponse)
  async uploadAvatar(
    @Args({ name: 'file', type: () => GraphQLUpload })
    file: Promise<FileUpload>,
    @CurrentUser() user,
  ): Promise<UploadResponse> {
    const { createReadStream, mimetype, filename } = await file;

    // 1. Fetch existing user to get old avatar publicId
    const existingUser = await this.userService.findById(user.sub);

    // 2. Upload new avatar
    const result: UploadApiResponse = await this.uploadService.uploadStream(
      createReadStream(),
      'avatars',
      mimetype,
      //      filename,
    );

    // 3. Delete old avatar from Cloudinary AFTER new one succeeds
    if (existingUser.avatarPublicId) {
      await this.uploadService
        .deleteByPublicId(existingUser.avatarPublicId)
        .catch(() => null); // non-fatal — don't fail the upload if delete fails
    }

    // 4. Persist new avatar URL + publicId to the user document
    await this.userService.updateAvatar(user.sub, {
      // avatar: result.secure_url,
      avatarPublicId: result.public_id,
    });

    return {
      url: result.secure_url,
      publicId: result.public_id,
      folder: 'avatars',
    };
  }

  // ─── Delete avatar — only the owner can delete their own ───────────

  @Roles(UserRole.GUEST)
  @UseGuards(GqlAuthGuard)
  @Mutation(() => Boolean)
  async deleteAvatar(@CurrentUser() user): Promise<boolean> {
    const existingUser = await this.userService.findById(user.sub);

    if (!existingUser.avatarPublicId) {
      return false; // nothing to delete
    }

    //  Only deletes the avatar belonging to the authenticated user
    await this.uploadService.deleteByPublicId(existingUser.avatarPublicId);

    await this.userService.updateAvatar(user.sub, {
      // avatar: null,
      avatarPublicId: null,
    });

    return true;
  }
}
