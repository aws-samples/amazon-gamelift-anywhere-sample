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
	"context"
	"fmt"
	"log"
	"net"
	"sync"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/gamelift"
)

type DisconnectReason int

const (
	DR_NONE             DisconnectReason = 0
	DR_ACTIVE           DisconnectReason = 1
	DR_ONCONNECT_ERROR  DisconnectReason = 2
	DR_IO_REQUEST_ERROR DisconnectReason = 3
	DR_COMPLETION_ERROR DisconnectReason = 4
	DR_SENDFLUSH_ERROR  DisconnectReason = 5
	DR_SENDBUFFER_ERROR DisconnectReason = 6
	DR_UNAUTH           DisconnectReason = 7
	DR_LOGOUT           DisconnectReason = 8
)

func (ps *PlayerSession) OnConnect(wg *sync.WaitGroup) bool {
	// In C++, called CreateIoCompletionPort with PlayerSession pointer as 'CompletionKey' argument
	// so that each session thread can retrive PlayerSession pointer when calling GetQueuedCompletionStatus in IOThread::DoIocpJob
	// Let's Start goroutine here with PlayerSession pointer as argument

	log.Print("Session OnConnect() implement this")
	ps.mConnected++

	// Run go routine for communication with each player
	go DoIocpJob(ps.mConn, ps, wg)

	return true
}

func (ps *PlayerSession) Disconnect(dr DisconnectReason) {
	/*
		/// already disconnected or disconnecting...
		if (0 == InterlockedExchange(&mConnected, 0))
			return;
	*/

	log.Printf("[DEBUG] Client Disconnected: Reason=%d %s\n", dr, ps.mClientAddr.String())

	err := ps.mConn.(*net.TCPConn).SetLinger(0)
	if err != nil {
		log.Printf("Error when setting linger: %s", err)
	}

	ps.OnDisconnect(dr)
	ps.mConn.Close()
}

func (ps *PlayerSession) PreRecv() bool {
	return true
}

func (ps *PlayerSession) PostRecv() bool {
	return true
}

func (ps *PlayerSession) PostSend(data []byte, len int) bool {
	// let's not use circular buffer for now.  Send to network directly
	n, err := ps.mConn.Write(data)
	if n != len {
		fmt.Printf("Write error: %d != %d\n", n, len)
	}

	if err != nil {
		fmt.Println("Write error: ", err)
		return false
	}

	return true
}

func (ps *PlayerSession) FlushSend() bool {
	return true
}
func (ps *PlayerSession) SendCompletion(transferred int) {}
func (ps *PlayerSession) RecvCompletion(transferred int) {}
func (ps *PlayerSession) EchoBack()                      {}

type PlayerSession struct {
	mClientAddr net.Addr
	mConn       net.Conn // Replace SOCKET
	//mRecvBuffer CircularBuffer
	//mSendBuffer CircularBuffer

	mConnected int

	mPlayerSessionId string
	mPlayerName      string
	mScore           int
	mGameLiftManager *GameLiftManager
}

func (ps *PlayerSession) IsValid() bool {
	if len(ps.mPlayerSessionId) > 0 {
		return true
	} else {
		return false
	}
}

func (ps *PlayerSession) PlayerReady(playerId string) {
	if ps.mGameLiftManager.AcceptPlayerSession(ps, playerId) {
		ps.mPlayerSessionId = playerId

		log.Print("Implement PlayerSession  PlalyerReady(). Let's Call this from GameLiftManager module.")

		var err error
		var cfg aws.Config

		ctx := context.TODO()

		cfg, err = config.LoadDefaultConfig(ctx)
		if err != nil {
			panic("configuration error, " + err.Error())
		}

		svc := gamelift.NewFromConfig(cfg)

		output, err := svc.DescribePlayerSessions(ctx,
			&gamelift.DescribePlayerSessionsInput{
				PlayerSessionId: &playerId,
			},
		)

		if err != nil {
			log.Fatal(err.Error())
		}

		log.Print(*output.PlayerSessions[0].PlayerId)

		/*
			   /// Score info from GL
			   Aws::GameLift::Server::Model::DescribePlayerSessionsRequest req;
			   req.SetPlayerSessionId(mPlayerSessionId);
			   auto outcome = Aws::GameLift::Server::DescribePlayerSessions(req);
			   if (!outcome.IsSuccess())
			   {
			       GConsoleLog->PrintOut(true, "[PLAYER] DescribePlayerSessions Error : %s \n", outcome.GetError().GetErrorMessage().c_str());
			       mScore = -1000;
			       mPlayerName = std::string("nonamed");
			       return;
			   }

				ps.mPlayerName = outcome.GetResult().GetPlayerSessions()[0].GetPlayerId();
		*/
		ps.mPlayerName = *output.PlayerSessions[0].PlayerId

		// TODO Skip FindScoreFromMatchData for now
		//ps.mScore = ps.mGameLiftManager.FindScoreFromMatchData(ps.mPlayerName)

		log.Print("[PLAYER] PlayerReady: ", playerId)
		ps.mGameLiftManager.CheckReadyAll()

		return
	}

	/// disconnect unauthed player
	ps.Disconnect(DR_UNAUTH)
}

func (ps *PlayerSession) PlayerExit(playerId string) {
	ps.mGameLiftManager.RemovePlayerSession(ps, playerId)

	ps.mPlayerSessionId = ""

	log.Print("[PLAYER] PlayerExit: ", playerId)

	ps.Disconnect(DR_LOGOUT)
}

func (ps *PlayerSession) OnDisconnect(dr DisconnectReason) {
	if ps.IsValid() {
		GGameLiftManager.RemovePlayerSession(ps, ps.mPlayerSessionId)
		ps.mPlayerSessionId = ""
	}
}

func (ps *PlayerSession) GetPlayerSessionId() string {
	return ps.mPlayerSessionId
}

func (ps *PlayerSession) GetPlayerName() string {
	return ps.mPlayerName
}

func (ps *PlayerSession) GetPlayerScore() int {
	return ps.mScore
}

func checkError(err error) bool {
	if err != nil {
		// TODO for now avoid Fatal error which terminates the process
		//log.Fatalln("Fatal error: ", err.Error())
		log.Print("Fatal error: ", err.Error())
		return true
	}
	return false
}
