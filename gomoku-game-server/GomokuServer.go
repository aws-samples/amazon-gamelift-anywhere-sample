/*
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: MIT-0
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this
 * software and associated documentation files (the "Software"), to deal in the Software
 * without restriction, including without limitation the rights to use, copy, modify,
 * merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
 * permit persons to whom the Software is furnished to do so.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
 * INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
 * PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
 * HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
 * OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
 * SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

package main

import (
	"flag"
	"log"
	"os"
)

var GGameLiftManager *GameLiftManager
var myLogger *log.Logger

func main() {
	var port int
	var gamelift_endpoint, fleet_id, host_id string

	fpLog, err := os.OpenFile("logfile.txt", os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0666)
	if err != nil {
		panic(err)
	}
	defer fpLog.Close()

	myLogger = log.New(fpLog, "INFO: ", log.Ldate|log.Ltime|log.Lshortfile)

	gamelift_endpoint = ""
	fleet_id = ""
	host_id = ""

	myLogger.Print("GAMELIFT_SDK_WEBSOCKET_URL=", os.Getenv("GAMELIFT_SDK_WEBSOCKET_URL"))
	myLogger.Print("GAMELIFT_SDK_AUTH_TOKEN=", os.Getenv("GAMELIFT_SDK_AUTH_TOKEN"))
	myLogger.Print("GAMELIFT_SDK_PROCESS_ID=", os.Getenv("GAMELIFT_SDK_PROCESS_ID"))
	myLogger.Print("GAMELIFT_SDK_HOST_ID=", os.Getenv("GAMELIFT_SDK_HOST_ID"))
	myLogger.Print("GAMELIFT_SDK_FLEET_ID=", os.Getenv("GAMELIFT_SDK_FLEET_ID"))

	flag.IntVar(&port, "port", 4000, "listen port for client access")
	flag.StringVar(&gamelift_endpoint, "endpoint", "", "gamelift endpoint URL")
	flag.StringVar(&fleet_id, "fleet-id", "", "fleet Id")
	flag.StringVar(&host_id, "host-id", "", "host id")

	flag.Parse()

	GGameLiftManager := &GameLiftManager{
		mPlayerReadyCount:      0,
		mCheckTerminationCount: 0,
		mGameSession:           nil,
	}

	sqs_endpoint := os.Getenv("SQS_ENDPOINT")

	if sqs_endpoint == "" {
		myLogger.Print("empty SQS ARN. Not sending game server results")
		GGameLiftManager.SetSQSClientInfo("", "", "")
	} else {
		myLogger.Print("Configuring SQS ARN: ", sqs_endpoint)
		GGameLiftManager.SetSQSClientInfo("ap-northeast-2", sqs_endpoint, "")
	}

	GGameLiftManager.InitializeGameLift(port, gamelift_endpoint, fleet_id, host_id)

	GIocpManager := IocpManager{}

	if false == GIocpManager.Initialize(port) {
		return
	}

	GIocpManager.StartIoThreads()

	GIocpManager.StartAccept(GGameLiftManager)

	GGameLiftManager.FinalizeGameLift()
	myLogger.Print("Exiting game server process")
}
