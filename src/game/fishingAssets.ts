import maleAvatar from '../assets/sprites/fishing/avatar-walk-4dir.png'
import femaleAvatar from '../assets/sprites/fishing/avatar-female-walk-4dir.png'
import maleWalk from '../assets/sprites/fishing/avatar-male-walk-v2.png'
import femaleWalk from '../assets/sprites/fishing/avatar-female-walk-v2.png'
import maleFishing from '../assets/sprites/fishing/avatar-male-fish-actions.png'
import femaleFishing from '../assets/sprites/fishing/avatar-female-fish-actions.png'
import malePortrait from '../assets/sprites/fishing/avatar-source.png'
import femalePortrait from '../assets/sprites/fishing/avatar-female-south.png'
import carp from '../assets/sprites/fishing/carp-tail.webp'
import silver from '../assets/sprites/fishing/fish-silver-tail.png'
import perch from '../assets/sprites/fishing/fish-perch-tail.png'
import catfish from '../assets/sprites/fishing/fish-catfish-tail.png'
import bream from '../assets/sprites/fishing/fish-bream-tail.png'
import type { FishId } from './fishingSpecies'
import type { AvatarId } from './fishingEconomy'

export const AVATAR_URLS: Record<AvatarId, string> = { male: maleAvatar, female: femaleAvatar }
export const WALK_URLS: Record<AvatarId, string> = { male: maleWalk, female: femaleWalk }
export const FISHING_ACTION_URLS: Record<AvatarId, string> = { male: maleFishing, female: femaleFishing }
export const AVATAR_PORTRAITS: Record<AvatarId, string> = { male: malePortrait, female: femalePortrait }
export const FISH_URLS: Record<FishId, string> = { carp, silver, perch, catfish, bream }
