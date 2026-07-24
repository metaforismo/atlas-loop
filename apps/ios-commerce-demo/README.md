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
- `gesture-lab.canvas` (instrumented pinch, rotation, and long-press target)
- `gesture-lab.reset`

Bundle id: `app.atlasloop.CommerceDemo`.

## Deterministic local routes

For local Simulator smoke runs, the app can launch directly into deterministic
fixture states without using primitive coordinate input:

```sh
xcrun simctl launch booted app.atlasloop.CommerceDemo --atlas-demo-route confirmation
```

Supported route values:

- `catalog`
- `product-detail`
- `cart`
- `shipping`
- `payment-review`
- `confirmation`
- `gesture-lab`

The same route can be supplied through `ATLAS_LOOP_DEMO_ROUTE` in the app
environment. The checkout routes are intended for local fixture proof. The
Gesture Lab is an instrumented native target for XCUITest long-press and
multi-touch actions; use the action result plus its metadata and
after-screenshot as the evidence chain.
