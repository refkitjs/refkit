import { liveSmoke } from '@refkit/provider-testkit/live'
import { pixabay, pixabayVideo } from '../index'

liveSmoke('pixabay', () => pixabay({ key: process.env.PIXABAY_KEY! }), { keyEnv: 'PIXABAY_KEY' })
liveSmoke('pixabay-video', () => pixabayVideo({ key: process.env.PIXABAY_KEY! }), { keyEnv: 'PIXABAY_KEY' })
