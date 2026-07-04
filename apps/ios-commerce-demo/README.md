# CommerceDemo

Deterministic SwiftUI iOS commerce demo for Atlas Loop simulator automation.

## Build

```sh
xcodebuild \
  -project apps/ios-commerce-demo/CommerceDemo.xcodeproj \
  -scheme CommerceDemo \
  -destination 'generic/platform=iOS Simulator' \
  build CODE_SIGNING_ALLOWED=NO
```

## Flow

The app uses local fixture data only and exposes stable accessibility identifiers:

- `catalog`
- `product-detail`
- `cart`
- `shipping`
- `payment-review`
- `confirmation`

Bundle id: `app.atlasloop.CommerceDemo`.
