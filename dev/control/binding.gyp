{
    "targets": [{
        "target_name": "easy-control",
        "conditions": [
            [
                "OS=='win'",
                {
                    "defines": ["IS_WINDOWS", "NAPI_DISABLE_CPP_EXCEPTIONS"],
                    "cflags": [
                        "-Wall",
                        "-Wparentheses",
                        "-Winline",
                        "-Wbad-function-cast",
                        "-Wdisabled-optimization"
                    ],
                    "sources": [
                        "src/main.cpp",
                        "src/mouse.cpp",
                        "src/keyboard.cpp",
                        "src/gamepad.cpp",
                        "src/screen.cpp",
                    ],
                    "include_dirs": [
                        "<!@(node -p \"require('node-addon-api').include\")",
                        "<(module_root_dir)/src/inc/"
                    ],
                    "libraries": [
                        "setupapi.lib",
                        "shell32.lib",
                        "<(module_root_dir)/src/inc/ViGEm/lib/ViGEmClient.lib"
                    ]
                }
            ],
            [
                "OS == 'mac'",
                {
                    "defines": ["IS_MACOS"],
                    "actions": [
                        {
                            "action_name": "copy_and_rename_cpp_to_mm",
                            "inputs": [
                                "src/main.cpp",
                                "src/mouse.cpp",
                                "src/keyboard.cpp",
                                "src/gamepad.cpp",
                                "src/screen.cpp",
                            ],
                            "outputs": [
                                "tmp/main.mm",
                                "tmp/mouse.mm",
                                "tmp/keyboard.mm",
                                "tmp/gamepad.mm",
                                "tmp/screen.mm",
                            ],
                            "action": [
                                "sh", "-c",
                                "mkdir -p tmp && cp src/main.cpp tmp/main.mm && cp src/mouse.cpp tmp/mouse.mm && cp src/keyboard.cpp tmp/keyboard.mm && cp src/gamepad.cpp tmp/gamepad.mm && cp src/screen.cpp tmp/screen.mm"
                            ]
                        },
                        {
                            "action_name": "build_swift",
                            "inputs": [
                                "src/GamepadImplement.swift"
                            ],
                            "outputs": [
                                "build_swift/GamepadImplement.a",
                                "build_swift/gamepad_implement-Swift.h"
                            ],
                            "action": [
                                "swiftc",
                                "src/GamepadImplement.swift",
                                "-emit-objc-header-path", "./build_swift/gamepad_implement-Swift.h",
                                "-emit-library", "-o", "./build_swift/GamepadImplement.a",
                                "-emit-module", "-module-name", "gamepad_implement",
                                "-module-link-name", "GamepadImplement",
                                "-framework", "IOKit",
                                "-framework", "Foundation"
                            ]
                        },
                        {
                            "action_name": "copy_swift_lib",
                            "inputs": [
                                "<(module_root_dir)/build_swift/GamepadImplement.a"
                            ],
                            "outputs": [
                                "<(PRODUCT_DIR)/GamepadImplement.a"
                            ],
                            "action": [
                                "sh",
                                "-c",
                                "cp -f <(module_root_dir)/build_swift/GamepadImplement.a <(PRODUCT_DIR)/GamepadImplement.a && install_name_tool -id @rpath/GamepadImplement.a <(PRODUCT_DIR)/GamepadImplement.a"
                            ]
                        }
                    ],
                    "sources": [
                        "tmp/main.mm",
                        "tmp/mouse.mm",
                        "tmp/keyboard.mm",
                        "tmp/gamepad.mm",
                        "tmp/screen.mm",
                        "src/GamepadBridge.m",
                        "src/GamepadImplement.swift"
                    ],
                    "include_dirs": [
                        "<!@(node -p \"require('node-addon-api').include\")",
                        "src",
                        "build_swift"
                    ],
                    "dependencies": [
                        "<!(node -p \"require('node-addon-api').gyp\")"
                    ],
                    "libraries": [
                        "<(PRODUCT_DIR)/GamepadImplement.a"
                    ],
                    "cflags!": [ "-fno-exceptions" ],
                    "cflags_cc!": [ "-fno-exceptions" ],
                    "xcode_settings": {
                        "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
                        "CLANG_ENABLE_OBJC_ARC": "YES",
                        "SWIFT_OBJC_BRIDGING_HEADER": "src/GamepadBridge.h",
                        "SWIFT_VERSION": "5.0",
                        "SWIFT_OBJC_INTERFACE_HEADER_NAME": "gamepad_implement-Swift.h",
                        "MACOSX_DEPLOYMENT_TARGET": "10.15",
                        "OTHER_CFLAGS": [
                            "-ObjC++",
                            "-fobjc-arc"
                        ],
                        "OTHER_LDFLAGS": [
                            "-Wl,-rpath,@loader_path",
                            "-Wl,-install_name,@rpath/GamepadImplement.a",
                            "-framework AppKit",
                            "-framework CoreGraphics",
                            "-framework IOKit",
                            "-framework Foundation"
                        ],
                        "HEADER_SEARCH_PATHS": [
                            "$(SRCROOT)/include",
                            "$(CONFIGURATION_BUILD_DIR)",
                            "$(SRCROOT)/build/Release",
                            "$(SRCROOT)/build_swift"
                        ]
                    }
                }
            ],
            [
                "OS == 'linux'",
                {
                    "defines": ["IS_LINUX", "NAPI_DISABLE_CPP_EXCEPTIONS"],
                    "cflags": [
                        "-Wall",
                        "-Wparentheses",
                        "-Winline",
                        "-Wbad-function-cast",
                        "-Wdisabled-optimization"
                    ],
                    "sources": [
                        "src/main.cpp",
                        "src/mouse.cpp",
                        "src/keyboard.cpp",
                        "src/gamepad.cpp",
                        "src/screen.cpp",
                    ],
                    "include_dirs": [
                        "<!@(node -p \"require('node-addon-api').include\")",
                        "<(module_root_dir)/src/inc/"
                    ],
                    "link_settings": {
                        "libraries": [
                            "-lpng",
                            "-lz",
                            "-lX11",
                            "-lXtst",
                            "-lXfixes",
                            "-lXrandr"
                        ]
                    }
                }
            ]
        ]
    }]
}