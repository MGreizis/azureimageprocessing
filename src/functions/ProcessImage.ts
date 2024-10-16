import { app, EventGridEvent, InvocationContext } from "@azure/functions";
import { BlobServiceClient } from "@azure/storage-blob";
import { Jimp } from "jimp";

/**
 * This is an Azure Functions Event Grid trigger that will be triggered whenever a blob is
 * uploaded to the configured blob container. The function will download the blob, convert it
 * to greyscale using the Jimp library, and then re-upload the processed image to a separate
 * container.
 * @param event The Event Grid event that triggered the function
 * @param context The Azure Functions context object
 * @returns A Promise that resolves when the function has completed
 */
export async function ProcessImage(event: EventGridEvent, context: InvocationContext): Promise<void> {
  context.log('Event grid function processed event:', event);

  try {
    const blobUrl = event.data?.url as string;

    if (!blobUrl) {
      throw new Error('Missing blob URL');
    }

    const blobName = blobUrl.split('/').pop();
    context.log(`Blob name: ${blobName}`);

    if (!blobName) {
      throw new Error('Missing blob name');
    }

    const blobServiceClient = BlobServiceClient.fromConnectionString(process.env.AzureWebJobsStorage);

    const containerName = process.env.BLOB_CONTAINER_NAME;

    if (!containerName) {
      throw new Error('BLOB_CONTAINER_NAME environment variable is not set.');
    }

    const containerClient = blobServiceClient.getContainerClient(process.env.BLOB_CONTAINER_NAME);

    const blockBlobClient = containerClient.getBlockBlobClient(blobName);

    const downloadBlockBlobResponse = await blockBlobClient.download();

    const imageBuffer = await streamToBuffer(downloadBlockBlobResponse.readableStreamBody);

    const image = await Jimp.read(imageBuffer);
    context.log('Loaded image');

    image.greyscale();
    context.log('Converted to greyscale');

    const processedImageBuffer = await image.getBuffer('image/jpeg');
    context.log('Processed image buffer ready');

    const processedBlobName = `processed-${blobName}`;
    const processedContainerClient = blobServiceClient.getContainerClient(process.env.PROCESSED_BLOB_CONTAINER_NAME);

    // Create the container if it doesn't exist
    const createContainerResponse = await processedContainerClient.createIfNotExists();
    if (createContainerResponse.succeeded) {
      context.log(`Created container: ${processedContainerClient.containerName}`);
    }

    const processedBlockBlobClient = processedContainerClient.getBlockBlobClient(processedBlobName);
    await processedBlockBlobClient.upload(processedImageBuffer, processedImageBuffer.length);

    context.log(`Processed image uploaded to: ${processedBlobName}`);
  } catch (error) {
    context.error(`Failed to process image: ${error}`);
  }
}

/**
 * A promise-based wrapper around a Node.js readable stream that resolves with a Buffer
 * containing all the data from the stream.
 * @param readableStream The readable stream to convert to a Buffer
 * @returns A Promise that resolves with a Buffer containing all the data from the stream
 */
async function streamToBuffer(readableStream: NodeJS.ReadableStream | null): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    readableStream?.on('data', (data) => {
      chunks.push(data instanceof Buffer ? data : Buffer.from(data));
    });
    readableStream?.on('end', () => {
      resolve(Buffer.concat(chunks))
    });
    readableStream.on('error', reject);
  })
}

app.eventGrid('ProcessImage', {
  handler: ProcessImage
});
