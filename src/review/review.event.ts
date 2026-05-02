/**
 * All NestJS EventEmitter event names for the Review domain.
 * Import this enum wherever you emit or listen to review events.
 */
export enum ReviewEvents {
  /**
   * Fired after a review is created, updated, or deleted.
   * Payload: { cabinId: string }
   */
  CHANGED = 'review.changed',
}
