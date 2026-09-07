import { SetMetadata } from '@nestjs/common';

export const ALLOW_ENTRY = 'auth:allowEntry';

/**
 * Opens a route to an entry session.
 *
 * The default is closed: a route nobody made a decision about refuses an
 * entry token, so a new route is never reachable from an inbox by accident.
 * Every use of this is a decision that the route can neither move money,
 * change the signer set, nor enrol a credential.
 */
export const AllowEntry = () => SetMetadata(ALLOW_ENTRY, true);
