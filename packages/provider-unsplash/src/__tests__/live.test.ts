import { liveSmoke } from '@refkit/provider-testkit/live'
import { unsplash } from '../index'

liveSmoke('unsplash', () => unsplash({ accessKey: process.env.UNSPLASH_KEY! }), { keyEnv: 'UNSPLASH_KEY' })
