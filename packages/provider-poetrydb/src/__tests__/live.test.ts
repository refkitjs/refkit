import { liveSmoke } from '@refkit/provider-testkit/live'
import { poetrydb } from '../index'

liveSmoke('poetrydb', () => poetrydb(), { query: 'love' })
