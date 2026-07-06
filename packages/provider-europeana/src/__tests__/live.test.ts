import { liveSmoke } from '@refkit/provider-testkit/live'
import { europeana } from '../index'

liveSmoke('europeana', () => europeana({ apiKey: process.env.EUROPEANA_KEY! }), { keyEnv: 'EUROPEANA_KEY' })
