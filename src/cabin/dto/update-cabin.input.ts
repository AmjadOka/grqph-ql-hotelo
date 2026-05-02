import { InputType, PartialType } from '@nestjs/graphql';
import { CreateCabinInput } from './create-cabin.input';

@InputType()
export class UpdateCabinInput extends PartialType(CreateCabinInput) {}
