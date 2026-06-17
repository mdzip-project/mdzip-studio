import { ApplicationConfig } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { providePrimeNG } from 'primeng/config';
import { definePreset } from '@primeng/themes';
import Aura from '@primeng/themes/aura';
import { routes } from './app.routes';

// The app is intentionally black/white/grey. Aura ships a coloured `primary`
// ramp and cool-tinted `zinc` surfaces, so we remap both to neutral grey.
// Colour is used only sparingly and deliberately (e.g. valid/error/warning
// status), which is applied directly in component styles rather than here.
const neutralRamp = {
  50: '{neutral.50}',
  100: '{neutral.100}',
  200: '{neutral.200}',
  300: '{neutral.300}',
  400: '{neutral.400}',
  500: '{neutral.500}',
  600: '{neutral.600}',
  700: '{neutral.700}',
  800: '{neutral.800}',
  900: '{neutral.900}',
  950: '{neutral.950}',
};

const Greyscale = definePreset(Aura, {
  semantic: {
    primary: neutralRamp,
    colorScheme: {
      light: {
        primary: {
          color: '{neutral.900}',
          contrastColor: '#ffffff',
          hoverColor: '{neutral.800}',
          activeColor: '{neutral.700}',
        },
        surface: { 0: '#ffffff', ...neutralRamp },
      },
      dark: {
        primary: {
          color: '{neutral.100}',
          contrastColor: '{neutral.950}',
          hoverColor: '{neutral.200}',
          activeColor: '{neutral.300}',
        },
        surface: { 0: '#ffffff', ...neutralRamp },
      },
    },
  },
});

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    provideAnimationsAsync(),
    providePrimeNG({
      theme: {
        preset: Greyscale,
        // Default darkModeSelector ('system') so PrimeNG dialogs follow the OS
        // color scheme, matching the app chrome (see app.component.scss).
      },
    }),
  ],
};
