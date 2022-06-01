// This example is written in Typescript.
// In order to run it on Node.js you first need to transpile the code.
// Follow instructions in README
import * as express from 'express';
import {
  verifyWebhookSignature,
  SignatureVerificationError,
} from '@blockfrost/blockfrost-js';

// You will find your webhook's secret auth token in your webhook settings in the Blockfrost Dashboard
const authToken = 'WEBHOOK_AUTH_TOKEN';
const app = express();

// Define endpoint /webhook that accepts POST requests
app.post(
  "/webhook",
  express.json({ type: "application/json" }),
  (request, response) => {
    const signatureHeader = request.headers["blockfrost-signature"];

    // Make sure that Blockfrost-Signature header exists
    if (!signatureHeader) {
      console.log("The request is missing Blockfrost-Signature header");
      return response.status(400).send(`Missing signature header`);
    }

    try {
      // Check the webhook signature
      const isValid = verifyWebhookSignature(
        JSON.stringify(request.body), // stringified request.body
        signatureHeader,
        authToken,
        600 // optional param to customize maximum allowed age of the webhook event, defaults to 600s
      );

      if (!isValid) {
        // Ignore the event if the signature is invalid
        console.log("Signature is not valid!");
        response.status(400).send("Signature is not valid!");
      } else {
        // Signature is valid
        const type = request.body.type;
        const payload = request.body.payload;

        // Process the incoming event
        switch (type) {
          case "transaction":
            // process Transaction event
            console.log(`Received ${payload.length} transactions`);
            // loop through the payload (payload is an array of Transaction events)
            for (const transaction of payload) {
              console.log(`Transaction ${transaction.tx.hash}`);
            }
            break;

          case "block":
            // process Block event
            console.log(`Received block hash ${payload.hash}`);
            break;

          case "delegation":
            // process Delegation event
            console.log(`Received ${payload.length} delegations`);
            // loop through the payload (payload is an array of Delegation events)
            for (const delegation of payload) {
              console.log(`Delegation from address ${delegation.address}`);
            }
            break;

          case "epoch":
            // process Epoch event
            console.log(
              `Epoch switch from ${payload.previous_epoch.epoch} to ${payload.current_epoch.epoch}`
            );
            break;

          default:
            console.warn(`Unexpected event type ${type}`);
            break;
        }

        // Return status code 2xx
        response.json({ processed: true });
      }
    } catch (err) {
      // Handle possible errors
      if (err instanceof SignatureVerificationError) {
        console.log(`SignatureVerificationError: ${err.message}`);
        response.status(400).send(`SignatureVerificationError`);
      } else {
        console.error(err);
        response.status(400).send(`Unexpected Error`);
      }
    }
  }
);

app.listen(6666, () => console.log('Running on port 6666'));
