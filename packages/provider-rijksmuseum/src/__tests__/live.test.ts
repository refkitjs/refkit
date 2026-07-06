import { liveSmoke } from '@refkit/provider-testkit/live'
import { rijksmuseum } from '../index'

liveSmoke('rijksmuseum', () => rijksmuseum())
