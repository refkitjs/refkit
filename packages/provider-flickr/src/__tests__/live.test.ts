import { liveSmoke } from '@refkit/provider-testkit/live'
import { flickr } from '../index'

liveSmoke('flickr', () => flickr({ apiKey: process.env.FLICKR_KEY! }), { keyEnv: 'FLICKR_KEY' })
