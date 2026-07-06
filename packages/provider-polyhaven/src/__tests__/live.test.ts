import { liveSmoke } from '@refkit/provider-testkit/live'
import { polyhaven, ambientcg } from '../index'

liveSmoke('polyhaven', () => polyhaven())
liveSmoke('ambientcg', () => ambientcg())
