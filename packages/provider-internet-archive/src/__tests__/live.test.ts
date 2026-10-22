import { liveSmoke } from '@refkit/provider-testkit/live'
import { internetArchive } from '../index'

liveSmoke('internet-archive', () => internetArchive())
// A text-only search must come back with texts only (the testkit rejects a film).
liveSmoke('internet-archive text-only', () => internetArchive(), { queryExtras: { modalities: ['text'] } })
