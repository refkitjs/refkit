import { liveSmoke } from '@refkit/provider-testkit/live'
import { jamendo } from '../index'

liveSmoke('jamendo', () => jamendo({ clientId: process.env.JAMENDO_CLIENT_ID! }), { keyEnv: 'JAMENDO_CLIENT_ID' })
