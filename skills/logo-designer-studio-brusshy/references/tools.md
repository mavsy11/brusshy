# Tool map: what to call when

Every tool acts on the user's **active version** unless you pass `frame=<id or name>`. Results tell you what the user changed by hand since your last call — keep those changes.

## Read the situation
| Need | Tool |
|---|---|
| Open the canvas for the user | `open_studio` |
| Logos in this project | `list_documents`, `open_document`, `new_document` |
| Versions, layers, brief, palette, type system, locks, construction | `get_document` |
| What the user selected / drew / dropped | `get_selection`, `get_sketch`, `get_board` |
| Brand files in `brusshy/brand/` | `get_brand_context` |
| Their notes on the logo | `get_annotations`, `resolve_annotation`, `watch_annotations` (also wakes for canvas-chat requests), `get_chat_requests` → `reply_chat`, images they pasted: `get_chat_images` |
| Design knowledge | `get_design_guide`, `list_techniques` |

## Draw and edit
| Need | Tool |
|---|---|
| First pass, or redraw a part | `set_svg` |
| Precise edits (move, recolor, reshape, rename, z-order) | `apply_ops` |
| Bend / twist a path | `deform_path` |
| Clean up geometry (simplify, smooth, bolder/thinner, round corners, optical centre, snap, symmetric) | `refine` |
| Combine shapes (union, subtract, intersect, exclude, divide) | `boolean` |
| Build on a grid (circle grid, golden ratio, keylines, radial) | `add_construction` → `fill_region` → `clear_construction` |
| Exact radial / mirror / grid repeats | `repeat` |
| Raw material shapes and symbols | `search_shapes` → `insert_shape` (always customise) |
| Trace a sketch, photo or object | `vectorize_reference` (mode `photo` for real objects) |

## Type
| Need | Tool |
|---|---|
| Find fonts, inspect axes/features/alternates | `list_fonts`, `font_info` |
| Weight/width/slant axes, OpenType features, alternates, kerning | `set_type` |
| Letter-by-letter shapes and layouts (arc, wave…) | `make_lettering`, `arrange_letters` |
| Warp a word or shape, outline/inline/shadow effects | `warp`, `warp_envelope`, `add_effect` |
| Heading + body pairing | `suggest_pairings`, `set_type_system` |

## Versions and exploration
| Need | Tool |
|---|---|
| Copy a version to try something | `duplicate_frame`, `new_frame` |
| Several directions side by side | `make_variants` → user picks → `continue_variant` |
| Jump back in time | `history`, `goto_history`, `undo`, `redo` |

## Check your work
| Need | Tool |
|---|---|
| See it (2D / 3D) | `render_preview` |
| 16–64 px on light and dark | `check_small_sizes` |
| Scored review with findings (pin them as notes) | `critique` |
| In context: app icon, browser tab, cards, signage… | `render_mockup` |
| Mark + wordmark balance by numbers | `get_lockup_metrics` |

## Build the system
| Need | Tool |
|---|---|
| Horizontal / stacked / icon / wordmark lockups | `make_lockup` |
| Palette, colorways, recolor | `generate_palette`, `set_palette`, `make_colorways`, `match_palette`, `get_style_profile` |
| 3D look | `list_presets`, `apply_style` |
| Motion | `set_animation`, `preview_animation` |
| Files (SVG, PNG, mono, icons, 3D, video, animated SVG/GIF, mockups, brand kit, construction sheet, timelapse) | `export` |
