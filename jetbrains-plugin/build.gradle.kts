plugins {
    id("java")
    id("org.jetbrains.intellij.platform") version "2.14.0"
}

group = "com.helioncoder"
version = "0.4.3"

val ideaPlatformVersion = "2025.3.3"

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}

dependencies {
    implementation("com.google.code.gson:gson:2.11.0")

    intellijPlatform {
        intellijIdea(ideaPlatformVersion)
        bundledPlugin("com.intellij.java")
        bundledPlugin("org.jetbrains.plugins.terminal")
    }
}

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(25))
    }
}

tasks.withType<JavaCompile>().configureEach {
    options.release.set(21)
}

val kotlinOutputDir = layout.buildDirectory.dir("classes/kotlin/main")
val ideaHomeProvider = providers.provider {
    val cacheRoot = file("${System.getProperty("user.home")}/.gradle/caches")
    cacheRoot
        .walkTopDown()
        .firstOrNull { it.isDirectory && it.name.startsWith("idea-$ideaPlatformVersion") }
        ?: error("IDEA $ideaPlatformVersion SDK was not found in Gradle caches. Run gradle buildPlugin once to download it.")
}
val compileHelionKotlin by tasks.registering(JavaExec::class) {
    group = "build"
    description = "Compiles the Kotlin bridge required by the JetBrains Inline Completion API."
    dependsOn(tasks.named("compileJava"))

    val ideaHome = ideaHomeProvider.get()
    val kotlinLib = ideaHome.resolve("plugins/Kotlin/kotlinc/lib")
    val sources = fileTree("src/main/kotlin") {
        include("**/*.kt")
    }

    inputs.files(sources)
    outputs.dir(kotlinOutputDir)

    classpath = files(kotlinLib.resolve("kotlin-compiler.jar"))
    mainClass.set("org.jetbrains.kotlin.cli.jvm.K2JVMCompiler")
    args(
        "-jvm-target", "21",
        "-Xjdk-release=21",
        "-d", kotlinOutputDir.get().asFile.absolutePath,
        "-classpath", files(
            sourceSets.main.get().compileClasspath,
            sourceSets.main.get().output.classesDirs,
            kotlinLib.resolve("kotlin-stdlib.jar"),
            kotlinLib.resolve("kotlin-stdlib-jdk7.jar"),
            kotlinLib.resolve("kotlin-stdlib-jdk8.jar"),
            kotlinLib.resolve("kotlinx-coroutines-core-jvm.jar")
        ).asPath
    )
    args(sources.files.map { it.absolutePath })
}

sourceSets {
    main {
        output.dir(kotlinOutputDir, "builtBy" to compileHelionKotlin)
    }
}

tasks.named("classes") {
    dependsOn(compileHelionKotlin)
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
            <p>
              HelionCoder brings the local HelionCoder CLI into JetBrains IDEs with a dark, VS Code-style assistant panel,
              editor-aware context, and real IDE integrations.
            </p>
            <p>
              Use it to chat with HelionCoder from inside the IDE, attach files, folders, selections, terminal context,
              and images, stream tool steps and thinking output, review generated file changes, and jump directly from
              assistant results back to source files.
            </p>
            <p>
              The plugin also provides all-language editor completion through HelionCoder ghost text suggestions.
              When a HelionCoder suggestion is visible, press Tab to accept it; otherwise Tab keeps the IDE's normal
              indentation, template, and completion behavior.
            </p>
            <ul>
              <li>Local CLI execution with project workspace context.</li>
              <li>Dark assistant tool window with streaming responses and control prompts.</li>
              <li>File, workspace, image, selection, and terminal attachments.</li>
              <li>Diff preview, accept, and reject flows for generated changes.</li>
              <li>Model selection and refresh from HelionCoder/OpenAI-compatible API configuration.</li>
              <li>Inline ghost-text completion for local text files across languages.</li>
            </ul>
        """.trimIndent()
    }
}

tasks {
    patchPluginXml {
        sinceBuild.set("253")
    }
}
