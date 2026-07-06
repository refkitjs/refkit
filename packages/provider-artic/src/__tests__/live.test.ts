import { liveSmoke } from '@refkit/provider-testkit/live'
import { artic } from '../index'

liveSmoke('artic', () => artic())
