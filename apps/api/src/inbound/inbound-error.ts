/** A refusal the web words for itself (`sk.inbound.errors`). */
export class InboundError extends Error {
  constructor(
    readonly code:
      | 'NOT_FOUND'
      | 'CUSTOMER_NOT_FOUND'
      | 'CONTACT_NOT_OF_CUSTOMER'
      | 'NOT_A_FORWARD'
      | 'ALREADY_IMPORTED',
  ) {
    super(code);
  }
}
