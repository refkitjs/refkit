import { liveSmoke } from '@refkit/provider-testkit/live'
import { smithsonian } from '../index'

liveSmoke('smithsonian', () => smithsonian({ apiKey: process.env.SI_KEY! }), { keyEnv: 'SI_KEY' })
