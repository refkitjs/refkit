import { liveSmoke } from '@refkit/provider-testkit/live'
import { freesound } from '../index'

liveSmoke('freesound', () => freesound({ apiKey: process.env.FREESOUND_TOKEN! }), { keyEnv: 'FREESOUND_TOKEN' })
