import { liveSmoke } from '@refkit/provider-testkit/live'
import { openverse, openverseAudio } from '../index'

liveSmoke('openverse', () => openverse())
liveSmoke('openverse-audio', () => openverseAudio())
