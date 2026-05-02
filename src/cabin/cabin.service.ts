/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Inject,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';

import { Cabin } from './cabin.schema';
import { CreateCabinInput } from './dto/create-cabin.input';
import { UpdateCabinInput } from './dto/update-cabin.input';
import { CabinQueryInput } from './dto/query-cabin-input.dto';
import { buildQuery } from '../common/utils/query-builder';
import { CabinCacheKeys } from '../common/utils/cache/cache-keys';

@Injectable()
export class CabinService {
  constructor(
    @InjectModel(Cabin.name) private cabinModel: Model<Cabin>,
    @Inject(CACHE_MANAGER) private cache: Cache,
  ) {}

  /* ─────────────────────────────────────────────────────
     PRIVATE — CACHE HELPERS
  ───────────────────────────────────────────────────── */

  private async cacheGet<T>(key: string): Promise<T | null> {
    return (await this.cache.get<T>(key)) ?? null;
  }

  private async cacheSet<T>(key: string, value: T, ttl = 60): Promise<void> {
    await this.cache.set(key, value, ttl);
  }

  /**
   * Registers a list-cache key in the shared index so
   * clearListCache() can bulk-invalidate all list variants at once.
   */
  private async trackListKey(key: string): Promise<void> {
    const index = (await this.cache.get<string[]>(CabinCacheKeys.index)) ?? [];
    if (!index.includes(key)) {
      await this.cache.set(CabinCacheKeys.index, [...index, key], 3600);
    }
  }

  /**
   * Deletes every tracked list-cache entry + the index itself.
   * Called after any mutation that changes list results.
   */
  async clearListCache(): Promise<void> {
    const index = (await this.cache.get<string[]>(CabinCacheKeys.index)) ?? [];
    await Promise.all(index.map((k) => this.cache.del(k)));
    await this.cache.del(CabinCacheKeys.index);
  }

  /* ─────────────────────────────────────────────────────
     PRIVATE — VALIDATION HELPERS
  ───────────────────────────────────────────────────── */

  /**
   * Throws BadRequestException if discount >= regularPrice.
   */
  private assertDiscountValid(regularPrice: number, discount: number): void {
    if (discount >= regularPrice) {
      throw new BadRequestException(
        'Discount must be less than the regular price',
      );
    }
  }

  /* ─────────────────────────────────────────────────────
     CREATE
  ───────────────────────────────────────────────────── */

  /**
   * Creates a new cabin.
   *
   * Enforces:
   * - Unique name (case-sensitive, via DB unique index)
   * - Discount < regularPrice
   *
   * Invalidates all list caches so the new cabin appears immediately.
   */
  async create(input: CreateCabinInput): Promise<Cabin> {
    const existing = await this.cabinModel.findOne({ name: input.name });
    if (existing) {
      throw new ConflictException('A cabin with this name already exists');
    }

    if (input.discount) {
      this.assertDiscountValid(input.regularPrice, input.discount);
    }

    const cabin = await this.cabinModel.create(input);
    await this.clearListCache();
    return cabin;
  }

  /* ─────────────────────────────────────────────────────
     READ — ALL
  ───────────────────────────────────────────────────── */

  /**
   * Returns a paginated, filtered list of cabins.
   *
   * Supported filters:
   * - `minPrice` / `maxPrice`  → regularPrice range
   * - `minCapacity`            → maxCapacity >= minCapacity
   * - `minRating`              → ratingAvg >= minRating
   * - `search`                 → full-text on name + description
   *
   * Cache strategy: key derived from full query object.
   */
  async findAll(query: CabinQueryInput & { minRating?: number }) {
    const key = CabinCacheKeys.list(query);
    const cached = await this.cacheGet(key);
    if (cached) return cached;

    const data = await buildQuery(this.cabinModel, query, {
      searchFields: ['name', 'description'],
      skipFields: ['minPrice', 'maxPrice', 'minCapacity', 'minRating'],
      customFilter: (q) => {
        const filter: Record<string, any> = {};

        if (q.minPrice || q.maxPrice) {
          filter.regularPrice = {};
          if (q.minPrice) filter.regularPrice.$gte = q.minPrice;
          if (q.maxPrice) filter.regularPrice.$lte = q.maxPrice;
        }

        if (q.minCapacity) {
          filter.maxCapacity = { $gte: q.minCapacity };
        }

        if (q.minRating) {
          filter.ratingAvg = { $gte: q.minRating };
        }

        return filter;
      },
    });

    await this.cacheSet(key, data);
    await this.trackListKey(key);
    return data;
  }

  /* ─────────────────────────────────────────────────────
     READ — SINGLE
  ───────────────────────────────────────────────────── */

  /**
   * Returns a single cabin by ID.
   * Includes up-to-date ratingAvg + ratingCount (updated by event listener).
   *
   * Cache: individual key per ID, invalidated by ReviewStatsListener and
   * CabinService.update / CabinService.remove.
   */
  async findOne(id: string): Promise<Cabin> {
    const key = CabinCacheKeys.one(id);
    const cached = await this.cacheGet<Cabin>(key);
    if (cached) return cached;

    const cabin = await this.cabinModel.findById(id).lean();
    if (!cabin) {
      throw new NotFoundException('No cabin found with this ID');
    }

    const data = { ...cabin, id: cabin._id.toString() } as unknown as Cabin;
    await this.cacheSet(key, data);
    return data;
  }

  /* ─────────────────────────────────────────────────────
     UPDATE
  ───────────────────────────────────────────────────── */

  /**
   * Updates a cabin's fields.
   *
   * Note: ratingAvg / ratingCount are managed exclusively by
   * ReviewStatsListener and must NOT be set here.
   *
   * Invalidates the cabin's individual cache entry + all list caches.
   */
  async update(id: string, input: UpdateCabinInput): Promise<Cabin> {
    const cabin = await this.cabinModel.findById(id);
    if (!cabin) {
      throw new NotFoundException('No cabin found with this ID');
    }

    if (input.name && input.name !== cabin.name) {
      const duplicate = await this.cabinModel.findOne({ name: input.name });
      if (duplicate) {
        throw new ConflictException('A cabin with this name already exists');
      }
    }

    const finalPrice = input.regularPrice ?? cabin.regularPrice;
    const finalDiscount = input.discount ?? cabin.discount;
    if (finalDiscount > 0) {
      this.assertDiscountValid(finalPrice, finalDiscount);
    }

    // Guard: never allow callers to overwrite rating fields via this mutation
    const safeInput = { ...input } as any;
    delete safeInput.ratingAvg;
    delete safeInput.ratingCount;

    const updated = await this.cabinModel.findByIdAndUpdate(id, safeInput, {
      new: true,
    });

    await this.clearListCache();
    await this.cache.del(CabinCacheKeys.one(id));

    return updated!;
  }

  /* ─────────────────────────────────────────────────────
     DELETE
  ───────────────────────────────────────────────────── */

  /**
   * Permanently removes a cabin from the database.
   * Returns true on success.
   * Invalidates the cabin's individual cache + all list caches.
   */
  async remove(id: string): Promise<boolean> {
    const result = await this.cabinModel.deleteOne({ _id: id });
    if (result.deletedCount === 0) {
      throw new NotFoundException('Cabin not found');
    }

    await this.clearListCache();
    await this.cache.del(CabinCacheKeys.one(id));
    return true;
  }
}
