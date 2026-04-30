plugins {
    id("java")
    id("org.jetbrains.intellij.platform") version "2.14.0"
}

group = "com.helioncoder"
version = "0.4.2"

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}

dependencies {
    intellijPlatform {
        intellijIdeaCommunity("2025.3.3")
        instrumentationTools()
        pluginVerifier()
        zipSigner()
    }
}

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(17))
    }
}

intellijPlatform {
    pluginConfiguration {
        id = "com.helioncoder.jetbrains"
        name = "HelionCoder"
        version = project.version.toString()

        ideaVersion {
            sinceBuild = "253"
        }

        vendor {
            name = "GabrielPondC"
        }

        description = """
            JetBrains IDE integration for the local HelionCoder CLI.
        """.trimIndent()
    }
}

tasks {
    patchPluginXml {
        sinceBuild.set("253")
    }
}
