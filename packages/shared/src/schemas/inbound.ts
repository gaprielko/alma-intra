import { z } from 'zod';
import { idSchema } from './common.js';

/**
 * Where an e-mail that came back stands: on a customer's timeline, waiting in „Nepriradené“ for
 * somebody to assign it, or put aside.
 */
export const INBOUND_STATUSES = ['assigned', 'unassigned', 'discarded'] as const;
export type InboundStatus = (typeof INBOUND_STATUSES)[number];

export const inboundIdSchema = z.object({ id: idSchema });
