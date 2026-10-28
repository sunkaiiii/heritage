export async function afterWebAssemblyStarted(blazor) {
    await window.heritageClient.initialize(blazor);
}
