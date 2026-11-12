{
    "targets": [{
        "target_name": "easy-control",
        "variables": {
            "conditions": [
                # the Swift compiler names the CPU as its target triple does, so
                # npm run build -- --arch x64 also cross-builds the Swift part
                ["target_arch=='x64'", { "swift_arch": "x86_64" }, { "swift_arch": "arm64" }]
            ]
        },
        # what every platform builds; each condition adds its own
        "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
        "sources": [
            "src/native/main.cpp",
            "src/native/mouse.cpp",
            "src/native/keyboard.cpp",
            "src/native/gamepad.cpp",
            "src/native/screen.cpp",
            "src/native/access.cpp"
        ],
        "include_dirs": [
            "<!@(node -p \"require('node-addon-api').include\")"
        ],
        "conditions": [
            [
                "OS=='win'",
                {
                    "defines": ["IS_WINDOWS"],
                    "msvs_settings": {
                        "VCCLCompilerTool": {
                            "WarningLevel": "3"
                        }
                    },
                    "sources": [
                        "src/native/gamepad_win.cpp"
                    ],
                    # every library the addon links, in one place
                    "libraries": [
                        "advapi32.lib",
                        "shcore.lib",
                        "cfgmgr32.lib",
                        "hid.lib",
                        "shell32.lib"
                    ]
                }
            ],
            [
                "OS == 'mac'",
                {
                    "defines": ["IS_MACOS"],
                    "actions": [
                        {
                            "action_name": "build_swift",
                            "inputs": [
                                "src/native/GamepadImplement.swift"
                            ],
                            "outputs": [
                                "build_swift/libGamepadImplement.a",
                                "build_swift/gamepad_implement-Swift.h"
                            ],
                            "action": [
                                "swiftc",
                                "src/native/GamepadImplement.swift",
                                "-parse-as-library",
                                "-emit-objc-header-path", "./build_swift/gamepad_implement-Swift.h",
                                "-emit-library", "-static", "-o", "./build_swift/libGamepadImplement.a",
                                "-module-name", "gamepad_implement",
                                "-target", "<(swift_arch)-apple-macos10.15"
                            ]
                        }
                    ],
                    "sources": [
                        "src/native/GamepadBridge.m"
                    ],
                    "include_dirs": [
                        "src/native",
                        "build_swift"
                    ],
                    "libraries": [
                        "<(module_root_dir)/build_swift/libGamepadImplement.a"
                    ],
                    "xcode_settings": {
                        "CLANG_ENABLE_OBJC_ARC": "YES",
                        "MACOSX_DEPLOYMENT_TARGET": "10.15",
                        "OTHER_CFLAGS": [
                            "-fobjc-arc"
                        ],
                        "OTHER_CPLUSPLUSFLAGS": [
                            "-ObjC++",
                            "-fobjc-arc"
                        ],
                        "OTHER_LDFLAGS": [
                            "-L/usr/lib/swift",
                            "-L<!(xcrun --show-sdk-path)/usr/lib/swift",
                            "-Wl,-rpath,/usr/lib/swift",
                            "-framework AppKit",
                            "-framework ApplicationServices",
                            "-framework Carbon",
                            "-framework CoreGraphics",
                            "-framework IOKit",
                            "-framework Foundation",
                            "-weak_framework CoreHID"
                        ]
                    }
                }
            ],
            [
                "OS == 'linux'",
                {
                    "defines": ["IS_LINUX"],
                    "cflags": [
                        "-Wall",
                        "-Wparentheses",
                        "-Wdisabled-optimization"
                    ],
                    "sources": [
                        "src/native/uinput.cpp",
                        "src/native/wayland.cpp"
                    ],
                    "link_settings": {
                        "libraries": [
                            "-lX11",
                            "-lXtst",
                            "-lXfixes",
                            "-lXrandr",
                            "-ldl"
                        ]
                    }
                }
            ]
        ]
    }]
}
