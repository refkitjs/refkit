import { liveSmoke } from '@refkit/provider-testkit/live'
import { gutendex } from '../index'

liveSmoke('gutendex', () => gutendex(), { query: 'love' })
