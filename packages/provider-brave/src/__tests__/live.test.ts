import { liveSmoke } from '@refkit/provider-testkit/live'
import { brave } from '../index'

liveSmoke('brave', () => brave({ token: process.env.BRAVE_TOKEN! }), { keyEnv: 'BRAVE_TOKEN' })
