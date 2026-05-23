import java.util.Locale

plugins {
    id("java-library")
    id("xyz.jpenilla.run-velocity") version "3.0.2"
}

repositories {
    mavenCentral()
    maven("https://repo.papermc.io/repository/maven-public/")
}

val velocityApiVersion = providers.gradleProperty("velocity_api_version").orNull ?: "3.4.0-SNAPSHOT"
val defaultVelocityRuntimeVersion = providers.gradleProperty("velocity_runtime_version").orNull ?: velocityApiVersion
val defaultVelocityBuild = providers.gradleProperty("velocity_build").orNull ?: "559"
val proxyImageContext = layout.buildDirectory.dir("proxy-image")

dependencies {
    compileOnly("com.velocitypowered:velocity-api:$velocityApiVersion")
}

fun projectValue(camelName: String, snakeName: String, envName: String, fallback: String): String {
    val value = findProperty(camelName)
        ?: findProperty(snakeName)
        ?: System.getenv(envName)
    return value?.toString()?.takeIf { it.isNotBlank() } ?: fallback
}

fun imageBuilderCommand() = projectValue("imageBuilder", "image_builder", "IMAGE_BUILDER", "podman")

fun proxyImageName() = projectValue("proxyImage", "proxy_image", "PROXY_IMAGE", "localhost/sisr-proxy:${project.version}")

fun velocityRuntimeVersion() = projectValue(
    "velocityRuntimeVersion",
    "velocity_runtime_version",
    "VELOCITY_RUNTIME_VERSION",
    defaultVelocityRuntimeVersion,
)

fun velocityBuild() = projectValue("velocityBuild", "velocity_build", "VELOCITY_BUILD", defaultVelocityBuild)

fun ghcrImageName(): String {
    val configured = findProperty("ghcrImage")
        ?: findProperty("ghcr_image")
        ?: System.getenv("GHCR_IMAGE")
    val value = if (configured == null || configured.toString().isBlank()) {
        val owner = findProperty("ghcrOwner")
            ?: findProperty("ghcr_owner")
            ?: System.getenv("GITHUB_REPOSITORY_OWNER")
        if (owner == null || owner.toString().isBlank()) {
            throw GradleException("Set -PghcrImage=ghcr.io/<owner>/sisr-proxy or -PghcrOwner=<owner> before running pushProxyImage")
        }
        "ghcr.io/${owner}/sisr-proxy"
    } else {
        configured.toString()
    }
    return value.lowercase(Locale.ROOT)
}

fun imageTagNames() = projectValue("imageTags", "image_tags", "IMAGE_TAGS", "${project.version},latest")
    .split(',')
    .map { it.trim() }
    .filter { it.isNotEmpty() }

java {
    toolchain.languageVersion = JavaLanguageVersion.of(21)
}

tasks {
    runVelocity {
        // Configure the Velocity version for our task.
        // This is the only required configuration besides applying the plugin.
        // Your plugin's jar (or shadowJar if present) will be used automatically.
        velocityVersion(velocityRuntimeVersion())
    }

    processResources {
        val props = mapOf("version" to version, "description" to project.description)
        filesMatching("velocity-plugin.json") {
            expand(props)
        }
    }

    val prepareProxyImageContext by registering(Sync::class) {
        group = "container"
        description = "Prepares build/proxy-image with the Containerfile and proxy plugin jar."
        dependsOn(jar)
        into(proxyImageContext)
        from("src/main/container") {
            include("Containerfile", "entrypoint.sh")
        }
        from(jar) {
            into("plugins")
            rename { "sisr-proxy.jar" }
        }
    }

    build {
        dependsOn(prepareProxyImageContext)
    }

    register<Exec>("buildProxyImage") {
        group = "container"
        description = "Builds the Velocity proxy image with Podman or Docker."
        dependsOn(prepareProxyImageContext)
        val contextDir = proxyImageContext.get().asFile
        commandLine(
            imageBuilderCommand(),
            "build",
            "-f",
            contextDir.resolve("Containerfile").absolutePath,
            "--build-arg",
            "VELOCITY_VERSION=${velocityRuntimeVersion()}",
            "--build-arg",
            "VELOCITY_BUILD=${velocityBuild()}",
            "-t",
            proxyImageName(),
            contextDir.absolutePath,
        )
    }

    register("pushProxyImage") {
        group = "container"
        description = "Tags and pushes the Velocity proxy image to GHCR."
        dependsOn(named("buildProxyImage"))
        notCompatibleWithConfigurationCache("Runs dynamic image tag and push commands.")
        doLast {
            val builder = imageBuilderCommand()
            val sourceImage = proxyImageName()
            val registryImage = ghcrImageName()
            imageTagNames().forEach { tag ->
                val targetImage = "${registryImage}:$tag"
                providers.exec { commandLine(builder, "tag", sourceImage, targetImage) }.result.get()
                providers.exec { commandLine(builder, "push", targetImage) }.result.get()
            }
        }
    }
}
