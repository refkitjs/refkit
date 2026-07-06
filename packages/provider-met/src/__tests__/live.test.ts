import { liveSmoke } from '@refkit/provider-testkit/live'
import { met } from '../index'

liveSmoke('met', () => met())
