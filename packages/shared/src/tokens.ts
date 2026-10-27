/** Design tokens shared by Tailwind (web) and NativeWind (mobile). Values from Figma "V2 – MVP". */
export const tokens = {
  colors: {
    primary: '#0F8B8D',
    primaryForeground: '#FFFFFF',
    primarySoft: '#E3F3F2',
    /** Figma „accent/text": teal text on `primarySoft` (the active tab). */
    primaryText: '#0A6466',
    /** neutrals retinted towards the teal (hue ~175), Figma „Farby“ of 1. 10. 2026. */
    ink: '#0C3B3C',
    background: '#FFFFFF',
    /** The app's canvas, behind the cards. */
    surface: '#F3F6F5',
    /** Hover, inputs, the quiet rows. */
    subtle: '#F7FAF9',
    border: '#E2EAE8',
    borderSubtle: '#EDF2F1',
    foreground: '#152B2A',
    muted: '#5B7472',
    /** Non-essential meta text only: it does not reach 4.5:1 on white. */
    tertiary: '#8FA3A1',
    success: '#16A34A',
    successSoft: '#EAF5E6',
    warning: '#D97706',
    warningSoft: '#FCF0DE',
    danger: '#DC2626',
    dangerSoft: '#FCE8E8',
    /** Days a nurse is away. */
    absence: '#6D28D9',
    absenceSoft: '#EFE9FD',
    /** The light tints of the dark surfaces (the toast, the illustrations' dots, the header's blobs). */
    tealLight: '#5FD0C9',
    /*
     * the phone's sign-in screens and the Profil header lie on `ink`, Figma `bg/dark`
     * (`VariableID:1:8`), which frames M01 and M25 bind. The text on it, each at 4.5:1 or more
     * (`tokens.test.ts`):
     */
    /** Secondary text on `ink`: the version line, the web sidebar's text (`web.sidebar.text`). */
    onDarkMuted: '#A9C9C7',
    /** M01: „Pre terénne sestry" under the name. */
    onDarkSoft: '#D7F2EF',
    /** M25: the role, registration and agency lines under her name. */
    onDarkMeta: '#A9D6D4',
    amber: '#FAC775',
    rose: '#F09595',
    lilac: '#B79CF0',
    /** The tray under the number keypad: a little darker than the canvas (Figma M08). */
    tray: '#E9EEED',
    /** Behind a photo shown full screen. */
    viewerBackdrop: '#111111',
  },
  /**
   * Patient avatars: a patient's initials sit on one of these pairs,
   * chosen from the name (`avatarColorOf` in the mobile app), so the same person keeps their colour.
   */
  avatars: [
    { bg: '#E3F3F2', text: '#0A6466' },
    { bg: '#E6F1FB', text: '#0C447C' },
    { bg: '#FAEEDA', text: '#854F0B' },
    { bg: '#FBEAF0', text: '#993556' },
    { bg: '#EEEDFE', text: '#3C3489' },
    { bg: '#EAF3DE', text: '#3B6D11' },
    { bg: '#FAECE7', text: '#993C1D' },
  ],
  /**
   * Icons in tinted circles: each section of a visit record keeps one tint, on
   * the summary of M11 and on the cards of M07. `bg` is the circle, `fg` the glyph on it.
   */
  sections: {
    notes: { bg: '#E3F3F2', fg: '#0A6466' },
    procedures: { bg: '#E6F1FB', fg: '#0C447C' },
    measurements: { bg: '#FCEBEB', fg: '#A32D2D' },
    items: { bg: '#FAEEDA', fg: '#854F0B' },
    photos: { bg: '#EAF3DE', fg: '#3B6D11' },
  },
  radius: { sm: 6, md: 10, lg: 16 },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
  /** The one typeface of both apps: Figtree, self-hosted, never fetched from Google. */
  fontFamily: 'Figtree',
  /**
   * The durations of the mobile app's motion, in ms: `fast` a press, `base` a
   * fade or a transition, `spring` a sheet, a pill or a toast (its spring's damping and
   * stiffness). The easing is Figma's `out`.
   */
  motion: {
    fast: 120,
    base: 250,
    spring: 350,
    springDamping: 15,
    springStiffness: 180,
    /** `cubic-bezier(.2,.8,.2,1)`. */
    easing: [0.2, 0.8, 0.2, 1],
  },
  /** The primary and the danger button are a gradient, top to bottom. */
  gradients: {
    primary: ['#14999B', '#0D8284'],
    danger: ['#CC3338', '#B22227'],
  },
  /**
   * The web app's own values, the
   * ones the phone has no use for. `apps/web/src/styles.css` mirrors them as theme variables, the
   * way `colors` is mirrored; keep the two in step.
   */
  web: {
    /** W9: canvas behind the cards, the surface of a card, the dark backdrop of an overlay. */
    colors: {
      /** a step darker than the phone's `surface`, so the cards hold on a projector. */
      canvas: '#EAF0EE',
      surface: '#FFFFFF',
      /** the web's borders and grey text, darker than `colors` for the same reason. */
      border: '#D6E1DE',
      borderSubtle: '#DFE8E6',
      muted: '#48625F',
      tertiary: '#6F8784',
      /** Under a dialog (55 %) and the ⌘K palette (50 %). The login's panel is `ink` (Figma `bg/dark`). */
      dark: '#0C2B2C',
      /** A hovered row, menu item or palette row: accent/soft at half strength. */
      hover: '#F0F8F7',
      /** A skeleton bar and the track of a segmented control; darker with `canvas`. */
      track: '#DDE6E3',
      /** The trust lines of the login panel. */
      trust: '#7FB3B0',
    },
    /**
     * W1: the dark teal sidebar and its one active colour. `bg` runs from `bgTop` to
     * `bgBottom`, with a glow of `iconActive` behind the brand; the active item is that glow too.
     */
    sidebar: {
      bg: '#0C3B3C',
      bgTop: '#104B4C',
      bgBottom: '#082C2D',
      border: '#1E4E4F',
      text: '#A9C9C7',
      textActive: '#FFFFFF',
      iconActive: '#5FD0C9',
    },
    /** W6: the web button gradients, a shade deeper than the phone's, top to bottom. */
    gradients: {
      primary: ['#139698', '#0B6E70'],
      danger: ['#D33A3F', '#B0232A'],
    },
    /**
     * W9: the corners of the web, in px. `control` is a button or a menu item, `input` a field,
     * `card` a card (its inner blocks take `inner`), `floating` a dropdown, popover or toast,
     * `dialog` a dialog, `pill` a chip, a search field or a segmented control's track.
     */
    radii: { inner: 12, control: 10, input: 12, card: 16, floating: 12, dialog: 24, pill: 999 },
    /**
     * W9 (Elevation/1–3) as CSS `box-shadow` values on the teal ink, plus the light edge: a 1 px
     * white line along the top of the main action card and the primary button.
     */
    elevation: {
      /** a little deeper than the phone's, as the web's canvas is darker. */
      rest: '0 1px 2px rgba(12, 59, 60, 0.08), 0 8px 22px rgba(12, 59, 60, 0.08)',
      raised: '0 2px 4px rgba(12, 59, 60, 0.08), 0 12px 28px rgba(12, 59, 60, 0.12)',
      floating: '0 1px 3px rgba(12, 59, 60, 0.06), 0 8px 24px rgba(12, 59, 60, 0.12)',
      button: '0 1px 2px rgba(12, 59, 60, 0.06), 0 4px 12px rgba(12, 59, 60, 0.07)',
      /** W2: under the header once the page has scrolled more than 8 px. */
      header: '0 4px 14px rgba(12, 43, 44, 0.06)',
      /** W22: above the sticky action bar while content is under it. */
      bar: '0 -6px 18px rgba(12, 43, 44, 0.07)',
      edge: 'inset 0 1px 0 rgba(255, 255, 255, 0.8)',
    },
    /** W18, W30: every duration of the web's motion, in ms, and the glow's breath in s. */
    motion: {
      press: 80,
      tooltipFade: 100,
      chip: 120,
      menu: 120,
      base: 150,
      slide: 180,
      enter: 200,
      skeletonDelay: 200,
      tooltipDelay: 300,
      flash: 300,
      collapse: 400,
      countUp: 600,
      shimmer: 1400,
      breath: 7000,
    },
  },
  /**
   * the depth of the mobile app's surfaces, in React Native's shape (one shadow on iOS,
   * `elevation` on Android), from Figma's two-layer shadows on the teal ink #0C3B3C:
   * * `rest`: every card, `0 1px 2px .06, 0 6px 16px .05`;
   * * `raised`: the „Teraz na rade" card, `0 1px 2px .06, 0 8px 20px .08`;
   * * `floating`: the tab bar, the action card and the sheets, `0 1px 3px .06, 0 8px 24px .12`;
   * * `button`: a round header button, `0 1px 2px .06, 0 4px 12px .07`.
   */
  elevation: {
    rest: {
      shadowColor: '#0C3B3C',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.07,
      shadowRadius: 10,
      elevation: 2,
    },
    raised: {
      shadowColor: '#0C3B3C',
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.09,
      shadowRadius: 14,
      elevation: 4,
    },
    floating: {
      shadowColor: '#0C3B3C',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.12,
      shadowRadius: 16,
      elevation: 8,
    },
    button: {
      shadowColor: '#0C3B3C',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.07,
      shadowRadius: 12,
      elevation: 2,
    },
  },
} as const;
