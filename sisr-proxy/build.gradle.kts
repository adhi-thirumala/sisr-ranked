import java.net.URI
import java.util.Locale

plugins {
    id("java-library")
    id("xyz.jpenilla.run-velocity") version "3.0.2"
}

repositories {
    mavenCentral()
    maven("https://repo.papermc.io/repository/maven-public/")
}

val velocityApiVersion = "3.5.0-SNAPSHOT"
val velocityRuntimeVersion = "3.5.0-SNAPSHOT"
val velocityBuild = "597"
val velocityDownloadUrl =
    "https://fill-data.papermc.io/v1/objects/ff08e7cae29dea20fcdb4f14092d825add6d265d5b2599ea5d5dbf54cb43c2d6/velocity-${velocityRuntimeVersion}-${velocityBuild}.jar"

val proxyImageContext = layout.buildDirectory.dir("proxy-image")

val downloadedVelocityJar = layout.buildDirectory.file("velocity/velocity.jar")

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
    /**
     * Download the Velocity runtime jar and keep it cached in the build directory
     * so every build (local run and Docker image) uses the exact same artifact
     * without making network calls inside the container.
     */
    val downloadVelocityRuntime by registering {
        group = "velocity"
        description = "Downloads the Velocity proxy server jar."
        val dest = downloadedVelocityJar.get().asFile
        val url = velocityDownloadUrl
        outputs.file(dest)

        doLast {
            if (!dest.exists()) {
                dest.parentFile.mkdirs()
                URI(url).toURL().openStream().use { input ->
                    dest.outputStream().use { output ->
                        input.copyTo(output)
                    }
                }
                // Reject error pages masquerading as a jar (HTML or JSON).
                val header = dest.inputStream().use { input ->
                    ByteArray(2).also { input.read(it) }
                }
                if (header[0] != 0x50.toByte() || header[1] != 0x4B.toByte()) {
                    val snippet = dest.readText().take(200)
                    dest.delete()
                    throw GradleException("Download from $url did not return a jar (got: $snippet)")
                }
            }
        }
    }

    runVelocity {
        velocityVersion(velocityRuntimeVersion)
        dependsOn(downloadVelocityRuntime)
    }

    processResources {
        val props = mapOf("version" to version, "description" to project.description)
        filesMatching("velocity-plugin.json") {
            expand(props)
        }
    }

    val prepareProxyImageContext by registering(Sync::class) {
        group = "container"
        description = "Prepares build/proxy-image with everything needed to build the Docker image."
        dependsOn(jar, downloadVelocityRuntime)
        into(proxyImageContext)
        from("src/main/container") {
            include("Containerfile", "entrypoint.sh")
        }
        from(jar) {
            into("plugins")
            rename { "sisr-proxy.jar" }
        }
        from(downloadedVelocityJar) {
            rename { "velocity.jar" }
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
