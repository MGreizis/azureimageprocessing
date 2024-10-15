import { app, EventGridEvent, InvocationContext } from "@azure/functions";
import { BlobServiceClient } from "@azure/storage-blob";
import { Jimp } from "jimp";

/**
 * This is an Azure Functions Event Grid trigger that will be triggered whenever a new image is uploaded to the blob storage container
 * specified in the BLOB_CONTAINER_NAME environment variable. The function will download the image, convert it to greyscale, and then
 * upload the processed image to the blob storage container specified in the PROCESSED_BLOB_CONTAINER_NAME environment variable.
 *
 * @param event The Event Grid event that triggered this function
 * @param context The InvocationContext object that provides information about the current invocation
 */
export async function ProcessImage(event: EventGridEvent, context: InvocationContext): Promise<void> {
  context.log('Event grid function processed event:', event);

  try {
    context.log('Event data: ', event.data);
    const blobUrl = event.data?.url as string;
    context.log(`Blob URL: ${blobUrl}`);

    if (!blobUrl) {
      throw new Error('Missing blob URL');
    }

    const blobName = blobUrl.split('/').pop();
    context.log(`Blob name: ${blobName}`);

    if (!blobName) {
      throw new Error('Missing blob name');
    }

    const blobServiceClient = BlobServiceClient.fromConnectionString(process.env.AzureWebJobsStorage);
    const containerClient = blobServiceClient.getContainerClient(process.env.BLOB_CONTAINER_NAME);
    context.log('Container client created');

    const blockBlobClient = containerClient.getBlockBlobClient(blobName);
    const downloadBlockBlobResponse = await blockBlobClient.download();
    context.log('Downloaded blob');

    const imageBuffer = await streamToBuffer(downloadBlockBlobResponse.readableStreamBody);
    context.log('Converted blob to buffer');

    const image = await Jimp.read(imageBuffer);
    context.log('Loaded image');

    image.greyscale();
    context.log('Converted to greyscale');

    const processedImageBuffer = await getBufferAsync(image, 'image/png');
    context.log('Processed image buffer ready');

    const processedBlobName = `processed-${blobName}`;
    const processedContainerClient = blobServiceClient.getContainerClient(process.env.PROCESSED_BLOB_CONTAINER_NAME);
    const processedBlockBlobClient = processedContainerClient.getBlockBlobClient(processedBlobName);
    await processedBlockBlobClient.upload(processedImageBuffer, processedImageBuffer.length);

    context.log(`Processed image uploaded to: ${processedBlobName}`);
  } catch (error) {
    context.error(`Failed to process image: ${error}`);
  }
}

/**
 * A promise-based wrapper around the Jimp getBuffer method
 * @param image The Jimp image object
 * @param mimeType The MIME type of the image
 * @returns A Promise that resolves with a Buffer containing the image data
 */
async function getBufferAsync(image, mimeType: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    image.getBuffer(mimeType, (err: Error, buffer: Buffer) => {
      if (err) {
        reject(err);
      } else {
        resolve(buffer);
      }
    })
  })
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
