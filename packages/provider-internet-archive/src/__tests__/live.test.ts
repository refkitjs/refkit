import { liveSmoke } from '@refkit/provider-testkit/live'
import { internetArchive } from '../index'

liveSmoke('internet-archive', () => internetArchive())
