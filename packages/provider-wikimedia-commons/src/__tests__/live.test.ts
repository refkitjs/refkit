import { liveSmoke } from '@refkit/provider-testkit/live'
import { wikimediaCommons } from '../index'

liveSmoke('wikimedia-commons', () => wikimediaCommons())
