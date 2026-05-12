import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserRole } from './user.schema';
import { UpdateUserInput } from './dto/update-user.input';
import * as bcrypt from 'bcrypt';
import { UserQueryInput } from './dto/create-user.input';
import { buildQuery } from 'src/common/utils/query-builder';
import type { AuthUser } from 'src/common/types/AuthUser';
import { Types } from 'mongoose';

function isObjectId(value: string): boolean {
  return Types.ObjectId.isValid(value);
}
/**
 * UserService
 *
 * Responsible for all user-related database operations including:
 * - Querying users with filters, search, pagination
 * - Retrieving single user records
 * - Updating user profile
 * - Managing avatar updates
 * - Soft deleting users (deactivation)
 */
@Injectable()
export class UserService {
  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<User>,
  ) {}

  /**
   * Retrieve all users with advanced query support.
   *
   * Features:
   * - Search by fullName and email
   * - Sorting by createdAt (default)
   * - Field selection (password excluded)
   * - Custom filtering (active status)
   *
   * @param query - Query parameters for filtering, searching, pagination
   * @returns List of users based on query
   */
  async findAll(query: UserQueryInput) {
    return await buildQuery(this.userModel, query, {
      searchFields: ['fullName', 'email'],
      defaultSort: 'createdAt',
      select: '-password',
      skipFields: ['active'],

      /**
       * Custom filter logic
       * Used to manually control specific query behavior
       */
      customFilter(query) {
        if (query.active !== undefined && query.active !== null) {
          return { active: query.active };
        }

        return {};
      },
    });
  }

  /**
   * Retrieves a user by MongoDB ObjectId or Email .
   *
   * Assumes the provided id is a valid ObjectId. Invalid IDs should be
   * validated before calling this method.
   *
   * @private MANAGER
   * @param input - MongoDB ObjectId || Email
   * @throws NotFoundException if user is not found
   * @returns The User document
   */
  async findOneByAdmin(input: string, user?: AuthUser): Promise<User> {
    if (!input) {
      throw new BadRequestException('User not found');
    }

    let query: any;

    const isId = isObjectId(input);
    console.log(isId);
    const isEmail = !isId;
    console.log(isEmail);
    // MANAGER can access by ID directly
    if (user?.role === UserRole.MANAGER && isId) {
      query = { _id: new Types.ObjectId(input) };
      console.log(query, 'query');
    }

    // email lookup
    else if (user?.role === UserRole.MANAGER && isEmail) {
      query = { email: input };
      console.log(isEmail, 'email');
    } else {
      throw new BadRequestException('Invalid input');
    }
    console.log(query, 'final query');
    const userFound = await this.userModel.findOne(query);

    if (!userFound) {
      throw new NotFoundException('User not found');
    }

    return userFound;
  }
  /**
   * Find user by ID with sensitive fields included.
   *
   * Used internally (e.g. file upload resolver) where avatar metadata is required.
   *
   * @param id - User ID
   * @returns Lean user object including avatarPublicId
   */
  async findById(id: string) {
    const user = await this.userModel
      .findById(id)
      .select('+avatarPublicId')
      .lean();

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async findMe(id: string) {
    return this.userModel.findById(id);
  }

  /**
   * Update user avatar only.
   *
   * Used by upload system after file storage (e.g. Cloudinary/S3).
   *
   * @param id - User ID
   * @param data - Avatar URL and publicId
   * @returns Updated user document
   */
  async updateAvatar(id: string, data: { avatarPublicId: string | null }) {
    return this.userModel.findByIdAndUpdate(
      id,
      {
        avatar: data.avatarPublicId,
      },
      { returnDocument: 'after' },
    );
  }

  /**
   * Update user profile data.
   *
   * Features:
   * - Supports partial updates
   * - Automatically hashes password if provided
   *
   * @param id - User ID
   * @param input - Update payload
   * @throws NotFoundException if user does not exist
   * @returns Updated user document
   */
  async update(id: string, input: UpdateUserInput) {
    console.log(input);
    const user = await this.userModel.findById(id);
    // Remove any undefined fields
    Object.keys(input).forEach((key) => {
      if (input[key] === undefined || input[key].length < 1) {
        console.log(input[key]);
        delete input[key];
      }
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Secure password update handling
    if (input.password) {
      input.password = await bcrypt.hash(input.password, 10);
    }

    return this.userModel.findByIdAndUpdate(id, input, { new: true });
  }

  /**
   * Soft delete user by marking them inactive.
   *
   * This avoids permanent deletion and preserves data integrity.
   *
   * @param id - User ID
   * @returns true if operation succeeded
   * @throws NotFoundException if user does not exist
   */
  async softDelete(id: string): Promise<boolean> {
    const user = await this.userModel.findByIdAndUpdate(id, {
      active: false,
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return true;
  }
}
