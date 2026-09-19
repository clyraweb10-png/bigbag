/**
 * High-performance CDN assets hosted on Cloudinary.
 * Offloads asset delivery to Cloudinary's global edge CDN so the app loads instantly with zero lag.
 */
export const CLOUDINARY_ASSETS = {
  // 6 Floating responsive mockup cards (dual light/dark mode)
  cardLeft1Light: "https://res.cloudinary.com/atqvkuh5/image/upload/v1789856252/bigbag/card-left-1-light.png",
  cardLeft1Dark: "https://res.cloudinary.com/atqvkuh5/image/upload/v1789856255/bigbag/card-left-1-dark.png",
  cardLeft2Light: "https://res.cloudinary.com/atqvkuh5/image/upload/v1789856258/bigbag/card-left-2-light.png",
  cardLeft2Dark: "https://res.cloudinary.com/atqvkuh5/image/upload/v1789856260/bigbag/card-left-2-dark.png",
  cardLeft3Light: "https://res.cloudinary.com/atqvkuh5/image/upload/v1789856262/bigbag/card-left-3-light.png",
  cardLeft3Dark: "https://res.cloudinary.com/atqvkuh5/image/upload/v1789856263/bigbag/card-left-3-dark.png",

  cardRight1Light: "https://res.cloudinary.com/atqvkuh5/image/upload/v1789856265/bigbag/card-right-1-light.png",
  cardRight1Dark: "https://res.cloudinary.com/atqvkuh5/image/upload/v1789856267/bigbag/card-right-1-dark.png",
  cardRight3Light: "https://res.cloudinary.com/atqvkuh5/image/upload/v1789856268/bigbag/card-right-3-light.png",
  cardRight3Dark: "https://res.cloudinary.com/atqvkuh5/image/upload/v1789856270/bigbag/card-right-3-dark.png",
  cardRight2Light: "https://res.cloudinary.com/atqvkuh5/image/upload/v1789856272/bigbag/card-right-2-light.png",
  cardRight2Dark: "https://res.cloudinary.com/atqvkuh5/image/upload/v1789856273/bigbag/card-right-2-dark.png",

  // Theme-aware UI icons
  githubLight: "https://res.cloudinary.com/atqvkuh5/image/upload/v1789856274/bigbag/github-light.png",
  githubDark: "https://res.cloudinary.com/atqvkuh5/image/upload/v1789856275/bigbag/github-dark.png",
  pencilIconLight: "https://res.cloudinary.com/atqvkuh5/image/upload/v1789856277/bigbag/pencil-icon.png",
  pencilIconDark: "https://res.cloudinary.com/atqvkuh5/image/upload/v1789856278/bigbag/pencil-icon-dark.png",
} as const;
