# Folo Mobile App 📱

This is the mobile client for FeyFeeds, built with [Expo](https://expo.dev).

## Mobile service URLs

Mobile keeps each service URL separate. Production builds set
`EXPO_PUBLIC_FEYFEEDS_API_URL_PRODUCTION` to the deployed FeyFeeds Worker
(`https://feyfeeds-api.feyfeeds.workers.dev`). Development, staging, and local
builds use `EXPO_PUBLIC_FEYFEEDS_API_URL_DEVELOPMENT`,
`EXPO_PUBLIC_FEYFEEDS_API_URL_STAGING`, and
`EXPO_PUBLIC_FEYFEEDS_API_URL_LOCAL` respectively. These are public base URLs,
not credentials. Leave an unavailable target unset: the FeyFeeds Cloud feature
then reports a configuration error instead of connecting to production.

For local API development, set the local variable to the reachable HTTP(S)
address of the local Worker, for example `http://192.168.1.10:8787` on a device
on the same network. Production requires HTTPS. Do not set a placeholder or a
production URL for local or staging work.

The legacy Folo API and web URLs remain separately configured for active legacy
authentication, reader/settings API calls, and feed/list share pages. Mobile
OTA is disabled and has no configured service URL. Image proxy/storage URLs are
not configured; source images load directly.

## Features

- Customized information hub for content discovery
- AI-powered features like translation and summary
- Dynamic content support (articles, videos, images, audio)
- $POWER integration for creator economy
- Cross-platform support (iOS & Android [WIP])
- Modern UI design with native feel

## Getting Started

1. Enable Corepack (if not already enabled)

   ```bash
   corepack enable
   ```

2. Install dependencies

   ```bash
   pnpm install
   ```

3. Start the development server
   ```bash
   pnpm run dev
   ```

You can run the app on:

- iOS Simulator (`pnpm run ios`)
- iOS Device (`pnpm run ios:device`)
- Android Emulator (`pnpm run android`)
- Development build for full native feature testing

## Project Structure

```
src/
├── modules/         # Feature-specific modules
│   ├── discover/    # Discovery feed features
│   └── ...
├── screens/         # App screens using file-based routing
└── ...
```

## Development

- Built with Expo SDK [>=52]
- Uses [Expo Router](https://docs.expo.dev/router/introduction/) for navigation
- Styling with [NativeWind](https://www.nativewind.dev/)
- State management with Jotai and Zustand
- API integration with Tanstack Query
- Full TypeScript support

## Useful Resources

- [Expo Documentation](https://docs.expo.dev/)
- [NativeWind Documentation](https://www.nativewind.dev/)
- [Main Project Repository](https://github.com/RSSNext/Follow)

## Need Help?

- Join our [Discord](https://discord.gg/AwWcAQ7euc)
- Follow us on [Twitter](https://x.com/folo_is)
- Contact the mobile development team

## License

This project is licensed under the GNU Affero General Public License version 3. See the main project repository for full license details.
