# K8ptain Styling & Theme Guide

This document outlines the design system and styling principles used in the K8ptain application.

## Design Philosophy
We aim for a **Premium, Floating, Glass-morphic** aesthetic. The UI should feel lightweight and open, avoiding heavy solid boxes where possible.

### 1. Global Background
The base of the application is a rich, deep gradient. This adds depth and avoids the flatness of a solid color.
- **Class**: `bg-gradient-to-br from-slate-900 via-[#0a0a0a] to-black`

### 2. Glass Panels
We use a "frosted glass" effect for containers, distinct from the background.
- **Light/Frosted**: Used for the Sidebar, Top Bars, and Tables to stand out against the dark content.
    - **Class**: `bg-white/5` (5% white opacity)
    - **Backdrop**: `backdrop-blur-xl` or `backdrop-blur-md`
- **Dark/Deep**: Used for main content areas or modals to recede or provide contrast.
    - **Class**: `bg-black/40` or `bg-slate-900/90` (for higher contrast drawers)

### 3. Floating Layout
Elements should appear to float.
- **Borders**: All glass panels have a subtle border definition to separate them from the background.
    - **Class**: `border border-white/10`
- **Shadows**: Deep shadows give lift.
    - **Class**: `shadow-2xl`
- **Corners**: Heavy rounding for a modern, friendly feel.
    - **Class**: `rounded-2xl` (Panels, Drawers), `rounded-xl` (Buttons, Smaller items)

### 4. Layout Structure
- **Sidebar**: A floating glass card on the left.
- **Main Content**: An open area blending with the background (no container box), maximizing space.
- **Top Bar**: A floating "header island" (rounded pill) within the main area.
- **Drawer**: A floating panel on the right (`top-4`, `right-4`, `bottom-4`) rather than a full-height slide-out.

### 5. Typography & Colors
- **Text**: `text-white` (Primary), `text-gray-400` (Secondary).
- **Accents**: Gradient backgrounds (`from-blue-600 to-purple-600`) for branding elements.
