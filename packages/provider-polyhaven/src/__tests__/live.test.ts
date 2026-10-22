import { liveSmoke } from '@refkit/provider-testkit/live'
import { polyhaven, ambientcg } from '../index'

liveSmoke('polyhaven', () => polyhaven())
liveSmoke('polyhaven-hdri', () => polyhaven({ assetType: 'hdris' }), { query: 'sunset' })
liveSmoke('ambientcg', () => ambientcg())
