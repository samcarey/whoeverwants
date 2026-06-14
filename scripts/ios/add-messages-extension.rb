#!/usr/bin/env ruby
# frozen_string_literal: true

# Adds the `MessagesExtension` iMessage app-extension target to
# ios/App/App.xcodeproj, idempotently. Run once to scaffold; the resulting
# project.pbxproj is committed, so this script is documentation + a re-runnable
# regenerator, NOT a CI step.
#
# Why a script and not hand-edited pbxproj: a new app-extension target means a
# PBXNativeTarget + product reference + Sources/Frameworks/Resources phases +
# an "Embed Foundation Extensions" copy phase on the host + a target dependency,
# all cross-referenced by generated UUIDs. The `xcodeproj` gem (pure Ruby, runs
# on Linux) gets the wiring right; hand-editing is a UUID minefield.
#
#   gem install xcodeproj
#   ruby scripts/ios/add-messages-extension.rb
#
# Phase 0 deliberately gave the extension NO custom entitlements so automatic
# signing could self-provision the new bundle ids with zero manual portal steps.
# Phase 1 added MessagesExtension.entitlements (the App Group identity bridge),
# which requires the one-time manual "App Groups" capability registration on
# com.whoeverwants.app[.latest].MessagesExtension in the Apple Developer portal.

require "xcodeproj"

PROJECT_PATH = File.expand_path("../../ios/App/App.xcodeproj", __dir__)
EXT_NAME = "MessagesExtension"
EXT_BUNDLE_ID = "com.whoeverwants.app.MessagesExtension"
DEPLOYMENT_TARGET = "15.0"

project = Xcodeproj::Project.open(PROJECT_PATH)

ext = project.targets.find { |t| t.name == EXT_NAME }

if ext.nil?
  app_target = project.targets.find { |t| t.name == "App" }
  raise "App target not found" unless app_target

  ext = project.new_target(:messages_extension, EXT_NAME, :ios, DEPLOYMENT_TARGET, nil, :swift)

  # Group holding the extension's sources (path-based so files resolve relative
  # to ios/App/MessagesExtension).
  group = project.main_group.new_group(EXT_NAME, EXT_NAME)
  swift_ref = group.new_reference("MessagesViewController.swift")
  assets_ref = group.new_reference("Assets.xcassets")
  group.new_reference("Info.plist") # referenced for the project navigator; not in a build phase
  group.new_reference("MessagesExtension.entitlements") # navigator only; wired via CODE_SIGN_ENTITLEMENTS

  ext.add_file_references([swift_ref])
  ext.resources_build_phase.add_file_reference(assets_ref)

  settings = {
    "PRODUCT_NAME" => "$(TARGET_NAME)",
    "PRODUCT_BUNDLE_IDENTIFIER" => EXT_BUNDLE_ID,
    "INFOPLIST_FILE" => "#{EXT_NAME}/Info.plist",
    "IPHONEOS_DEPLOYMENT_TARGET" => DEPLOYMENT_TARGET,
    "SWIFT_VERSION" => "5.0",
    "TARGETED_DEVICE_FAMILY" => "1,2",
    "CODE_SIGN_STYLE" => "Automatic",
    "CODE_SIGN_ENTITLEMENTS" => "#{EXT_NAME}/#{EXT_NAME}.entitlements",
    "GENERATE_INFOPLIST_FILE" => "NO",
    "ASSETCATALOG_COMPILER_APPICON_NAME" => "iMessage App Icon",
    "MARKETING_VERSION" => "1.0",
    "CURRENT_PROJECT_VERSION" => "1",
    "SKIP_INSTALL" => "NO",
    "LD_RUNPATH_SEARCH_PATHS" => [
      "$(inherited)",
      "@executable_path/Frameworks",
      "@executable_path/../../Frameworks",
    ],
  }

  ext.build_configurations.each do |config|
    config.build_settings.merge!(settings)
  end

  # Embed the .appex into the host app + make the app depend on it.
  app_target.add_dependency(ext)
  embed_phase = app_target.new_copy_files_build_phase("Embed Foundation Extensions")
  embed_phase.symbol_dst_subfolder_spec = :plug_ins
  embed_phase.dst_path = ""
  build_file = embed_phase.add_file_reference(ext.product_reference)
  build_file.settings = { "ATTRIBUTES" => ["RemoveHeadersOnCopy"] }

  # Automatic provisioning for the new target.
  attrs = project.root_object.attributes["TargetAttributes"] ||= {}
  attrs[ext.uuid] = { "ProvisioningStyle" => "Automatic" }

  puts "Added #{EXT_NAME} target (#{EXT_BUNDLE_ID}) and embedded it in App."
else
  puts "#{EXT_NAME} target already exists — ensuring shared sources."
end

# Phase 4 (compose-a-poll-in-Messages) reuses the natural-language parser. Like
# every other "compile a pure-Foundation file into both targets" case, the
# extension shares App/PollTextParser.swift rather than duplicating it (it's the
# documented precedent + carries the JS↔Swift parity contract, so a copy would
# rot). Idempotent: the existing App-target PBXFileReference is added to the
# extension's Sources phase only if not already present.
parser_ref = project.files.find { |f| f.display_name == "PollTextParser.swift" }
raise "PollTextParser.swift file reference not found in project" unless parser_ref
unless ext.source_build_phase.files_references.include?(parser_ref)
  ext.add_file_references([parser_ref])
  puts "Added PollTextParser.swift to #{EXT_NAME} sources (shared with App)."
end

project.save
