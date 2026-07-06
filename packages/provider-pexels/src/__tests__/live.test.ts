import { liveSmoke } from '@refkit/provider-testkit/live'
import { pexels, pexelsVideo } from '../index'

liveSmoke('pexels', () => pexels({ apiKey: process.env.PEXELS_KEY! }), { keyEnv: 'PEXELS_KEY' })
liveSmoke('pexels-video', () => pexelsVideo({ apiKey: process.env.PEXELS_KEY! }), { keyEnv: 'PEXELS_KEY' })
