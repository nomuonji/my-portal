import { getContrastRatio } from '@mui/material/styles';

// Helper to convert hex to HSL
export function hexToHsl(hex) {
  let r = 0, g = 0, b = 0;
  // handle 3-digit hex
  if (hex.length === 4) {
    r = parseInt(hex[1] + hex[1], 16);
    g = parseInt(hex[2] + hex[2], 16);
    b = parseInt(hex[3] + hex[3], 16);
  } else if (hex.length === 7) {
    r = parseInt(hex.substring(1, 3), 16);
    g = parseInt(hex.substring(3, 5), 16);
    b = parseInt(hex.substring(5, 7), 16);
  }
  r /= 255;
  g /= 255;
  b /= 255;

  let max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;

  if (max === min) {
    h = s = 0; // achromatic
  } else {
    let d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
      default: break; // Add default case
    }
    h /= 6;
  }

  return [h * 360, s * 100, l * 100];
}

// Helper to convert HSL to hex
export function hslToHex(h, s, l) {
  l /= 100;
  const a = s * Math.min(l, 1 - l) / 100;
  const f = n => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// Function to generate a consistent color from a string (tag)
export const getTagColor = (tag) => {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) {
    hash = tag.charCodeAt(i) + ((hash << 5) - hash);
  }
  let color = '#';
  for (let i = 0; i < 3; i++) {
    const value = (hash >> (i * 8)) & 0xFF;
    color += ('00' + value.toString(16)).substr(-2);
  }
  return color;
};

// Function to calculate the average of multiple hex colors
export function getAverageColor(colors) {
  const rgbColors = colors.map(hex => {
    let r = 0, g = 0, b = 0;
    if (hex.length === 4) {
      r = parseInt(hex[1] + hex[1], 16);
      g = parseInt(hex[2] + hex[2], 16);
      b = parseInt(hex[3] + hex[3], 16);
    } else if (hex.length === 7) {
      r = parseInt(hex.substring(1, 3), 16);
      g = parseInt(hex.substring(3, 5), 16);
      b = parseInt(hex.substring(5, 7), 16);
    }
    return { r, g, b };
  });

  const total = rgbColors.reduce((acc, c) => {
    acc.r += c.r;
    acc.g += c.g;
    acc.b += c.b;
    return acc;
  }, { r: 0, g: 0, b: 0 });

  const avg = {
    r: Math.round(total.r / rgbColors.length),
    g: Math.round(total.g / rgbColors.length),
    b: Math.round(total.b / rgbColors.length)
  };

  return `#${avg.r.toString(16).padStart(2, '0')}${avg.g.toString(16).padStart(2, '0')}${avg.b.toString(16).padStart(2, '0')}`;
}

export const getBackgroundStyle = (tags, defaultStyle) => {
  if (!tags || tags.length === 0) {
    return defaultStyle;
  }

  const subduedColors = tags.map(tag => {
    const hsl = hexToHsl(getTagColor(tag));
    hsl[2] = Math.max(20, hsl[2] - 30); // darken
    return hslToHex(hsl[0], hsl[1], hsl[2]);
  });

  const avgColor = getAverageColor(subduedColors);
  const textColor = getContrastRatio(avgColor, '#fff') > 4.5 ? '#fff' : '#000';

  if (subduedColors.length === 1) {
    return { backgroundColor: subduedColors[0], color: textColor };
  }

  return {
    background: `linear-gradient(to right, ${subduedColors.join(', ')})`,
    color: textColor
  };
};
