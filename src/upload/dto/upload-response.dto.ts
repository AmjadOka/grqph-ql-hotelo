import { ObjectType, Field } from '@nestjs/graphql';

@ObjectType()
export class UploadResponse {
  @Field()
  url: string;

  @Field()
  publicId: string;

  @Field()
  folder: string;
}
